validatorInstance = (function(){
	var validator = {};
	var emailPattern = /[a-zA-Z0-9]*@[a-zA-Z0-9]*\.[com]/;

	validator.collectUserData = function(validClubs, clubAndPassword){

		var userFields = {};
		var valid = '';
		var required = ' is required.';

		userFields.username = $('form[id="userRegistrationForm"] #usernameRegistration').val();
		userFields.firstname = $('form[id="userRegistrationForm"] #first_name').val();
		userFields.lastname = $('form[id="userRegistrationForm"] #last_name').val();
		userFields.email = $('form[id="userRegistrationForm"] #email').val();
		userFields.password = $('form[id="userRegistrationForm"] #hashed_password').val();
		userFields.passwordConfirmation = $('form[id="userRegistrationForm"] #passwordConfirmation').val();
		userFields.club = $('form[id="userRegistrationForm"] #club').val();
		userFields.clubPassword = $('form[id="userRegistrationForm"] #clubPassword').val();
		userFields.role = $('form[id="userRegistrationForm"] #role').val();
		
		this.validateUsers(userFields, validClubs, clubAndPassword);
	}

	validator.collectUserDataForEditing = function(validClubs, clubAndPassword, currentUserName, currentEmail, editUsers_existingUserUserNames,editUsers_existingUserEmails){
		var editUserFields = {};
		var valid = '';
		var required = ' is required.';

		editUserFields.username = $('form[id="editUserForm"] #editUserForm_username').val();
		editUserFields.firstname = $('form[id="editUserForm"] #editUserForm_first_name').val();
		editUserFields.lastname = $('form[id="editUserForm"] #editUserForm_last_name').val();
		editUserFields.email = $('form[id="editUserForm"] #editUserForm_email').val();
		editUserFields.emailPattern = /[a-zA-Z0-9]*@[a-zA-Z0-9]*\.[com]/;								
		editUserFields.password = $('form[id="editUserForm"] #editUserForm_hashed_password').val();
		editUserFields.passwordConfirmation = $('form[id="editUserForm"] #editUserForm_passwordConfirmation').val();
		editUserFields.club = $('form[id="editUserForm"] #editUserForm_club').val();
		editUserFields.clubPassword = $('form[id="editUserForm"] #editUserForm_clubPassword').val();
		editUserFields.role = $('form[id="editUserForm"] #editUserForm_role').val();
		
		this.validateUsers(editUserFields, validClubs, clubAndPassword, currentUserName, currentEmail, editUsers_existingUserUserNames,editUsers_existingUserEmails);
	}

	validator.collectCategoryData = function(uploadCategory_existingTitles){

		var categoryFields = {};

		categoryFields.currentSelectedManual = $('#categorySubmit #manuals').val();
		categoryFields.categoryTitle = $('#categorySubmit #uploadCategory_category_title').val();
		categoryFields.categoryDescription = $('#categorySubmit #uploadCategory_category_description').val();
		this.validateCategories(categoryFields, uploadCategory_existingTitles);
	}

	validator.collectCategoryDataForEditing = function(uploadCategory_existingTitles, currentTitle){
		var editUserFields = {};

		editUserFields.currentSelectedManual = $('#editCategoryForm #editCategory_manuals').val();
		editUserFields.categoryTitle = $('#editCategoryForm #editCategory_category_title').val();
		editUserFields.categoryDescription = $('#editCategoryForm #editCategory_category_description').val();
		
		this.validateCategories(editUserFields, uploadCategory_existingTitles,currentTitle);
	}

	validator.collectRoleData = function(existingRoles,currentRole){
		var roleFields = {};
		roleFields.role = $('form[id="userRoleInputForm"] #uploadRole_role').val();
		this.validateRoles(roleFields,existingRoles);
	}

	validator.collectRoleDataForEditing = function(existingRoles,currentRole){
		var roleFields = {};
		roleFields.role = $('form[id="editRoleForm"] #editRole_role').val();
		this.validateRoles(roleFields,existingRoles,currentRole);
	}

	validator.collectManualData = function(existingManuals,currentManual){
		var manualFields = {};
		manualFields.manual = $('#manualAddForm #uploadManual_description').val();
		this.validateManuals(manualFields,existingManuals);
	}

	validator.collectManualDataForEditing = function(existingManuals,currentManual){
		var manualFields = {};
		manualFields.manual = $('#editManualForm #editManual_description').val();
		this.validateManuals(manualFields,existingManuals,currentManual);
	}

	validator.collectClubData = function(uploadClubs_existingClubs){

		var clubFields = {};
		var valid = '';
		var required = ' is required.';

		clubFields.name = $('#uploadClubsForm #uploadClubsForm_name').val();
		clubFields.address = $('#uploadClubsForm #uploadClubsForm_address').val();
		clubFields.city = $('#uploadClubsForm #uploadClubsForm_city').val();
		clubFields.state = $('#uploadClubsForm #uploadClubsForm_state').val();
		clubFields.zip = $('#uploadClubsForm #uploadClubsForm_zip').val();
		clubFields.password = $('#uploadClubsForm #uploadClubsForm_password').val();
		this.validateClubs(clubFields, uploadClubs_existingClubs);
	}

	validator.collectClubDataForEditing = function(uploadClubs_existingClubs,currentClub){
		var editUserFields = {};
		var valid = '';
		var required = ' is required.';

		editUserFields.name = $('#editClubForm #editClub_name').val();
		editUserFields.address = $('#editClubForm #editClub_address').val();
		editUserFields.city = $('#editClubForm #editClub_city').val();
		editUserFields.state = $('#editClubForm #editClub_state').val();
		editUserFields.zip = $('#editClubForm #editClub_zip').val();
		editUserFields.password = $('#editClubForm #editClub_password').val();
		this.validateClubs(editUserFields, uploadClubs_existingClubs,currentClub);	
	}

	validator.validateUsers = function(required_fields, validClubs, clubsAndPasswords, currentUserName, currentEmail, existingUserNames, existingEmails){
		var valid = '';
		var formid = '';
		if($('#userRegistrationForm').length){

			formid = '#userRegistrationForm';

			if(required_fields.username == ''){
				valid += '<p> Username is required. </p>';
				$('form[id="userRegistrationForm"] #usernameRegistration').siblings('div[class="validation"]').text('User Name is required.');
			}	

			if(required_fields.firstname == ''){
				valid += '<p> A First Name is required. </p>';
				$('form[id="userRegistrationForm"] #first_name').siblings('div[class="validation"]').text('First name is required.');
			}

			if(required_fields.lastname == ''){
				valid += '<p> A Last Name is required. </p>';
				$('form[id="userRegistrationForm"] #last_name').siblings('div[class="validation"]').text('Last name is required.');
			}

			if(required_fields.email == ''){
				valid += '<p> Email is required. </p>';
				$('form[id="userRegistrationForm"] #email').siblings('div[class="validation"]').text('Email is required.');
			} else if ((required_fields.email.length > 0) && (!emailPattern.test(required_fields.email))){
				$('form[id="userRegistrationForm"] #email').siblings('div[class="validation"]').text('Proper email format required.');
			}

			if(required_fields.password == ''){
				valid += '<p> Password is required. </p>';
				$('form[id="userRegistrationForm"] #hashed_password').siblings('div[class="validation"]').text('Password is required.');
			} else if (required_fields.password !== required_fields.passwordConfirmation){
				valid += '<p> Password must match confirmation. </p>';
				$('form[id="userRegistrationForm"] #hashed_password').siblings('div[class="validation"]').text('Password must match confirmation.');
			} else {
				$('form[id="userRegistrationForm"] #hashed_password').siblings('div[class="validation"]').text('');													
			}

			if(required_fields.passwordConfirmation == ''){
				valid += '<p> Password Confirmation is required. </p>';
			}	

			if(required_fields.password != required_fields.passwordConfirmation){
				valid += '<p> Password and Password Confirmation don\'t match.</p>';
			}	

			if(required_fields.club == ''){
				valid += '<p> A club is required. </p>';
			}	
			if(jQuery.inArray(required_fields.club, validClubs) == -1){
				valid += '<p> Invalid club selected. </p>';
			} else {
				passwordIndex = jQuery.inArray(required_fields.club, validClubs);
				required_fields.clubPasswordVerification = clubsAndPasswords[passwordIndex];
			}

			if(required_fields.clubPassword == ''){
				valid += '<p> Please enter a club password. </p>';
			}

			if(required_fields.clubPassword != required_fields.clubPasswordVerification){
				valid += '<p> Invalid club password. </p>';
				$('form[id="userRegistrationForm"] #clubPassword').siblings('div[class="validation"]').text('Club password is required.');
			}

			if(required_fields.role == ''){
				valid += '<p> A role is required. </p>';
				$('form[id="userRegistrationForm"] #role').siblings('div[class="validation"]').text('A role is required.');

			}		

			if((required_fields.role < 1) || (required_fields.role > 4)){
				valid += '<p> Please select a proper user role. </p>';
			}
			if(valid.length > 0){
				$('div[class="alert alert-error"]').remove();
				$('div[class="alert alert-success"]').remove();
				errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
				$("#registerErrorMessages").append(errorDisplay);
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
			} else {
				userFormData = $('form[id="userRegistrationForm"]').serialize();
				this.submitData('login.php',userFormData, formid, "#users", "userALE.php");
			}
		} else if($('#editUserForm').length){

			formid = '#editUserForm';
			
			if(required_fields.username.length == 0){
				valid += '<p> Username is required. </p>';
				$('form[id="editUserForm"] #editUserForm_username').next('div[class="validation"]').text('Username is required.');
			} else if ((jQuery.inArray(required_fields.username, existingUserNames) >= 0) && (currentUserName != existingUserNames[(jQuery.inArray(required_fields.username, existingUserNames))])) {
				valid += '<p> This user name has been taken. </p>';
				$('#editUserForm_username').next('div[class="validation"]').text('This user name has been taken.');
			} else {
				$('form[id="editUserForm"] #editUserForm_username').next('div[class="validation"]').text('');	
			}
			if(required_fields.firstname.length == 0){
				valid += '<p> A First Name is required. </p>';
				$('form[id="editUserForm"] #editUserForm_first_name').next('div[class="validation"]').text('A First Name is required.');
			} else {
				$('form[id="editUserForm"] #editUserForm_first_name').next('div[class="validation"]').text('');	
			}

			if(required_fields.lastname == ''){
				valid += '<p> A Last Name is required. </p>';
				$('form[id="editUserForm"] #editUserForm_last_name').next('div[class="validation"]').text('A Last Name is required.');
			} else {
				$('form[id="editUserForm"] #editUserForm_last_name').next('div[class="validation"]').text('');	
			}

			if(required_fields.email == ''){
				valid += '<p> Email is required. </p>';
				$('form[id="editUserForm"] #editUserForm_email').next('div[class="validation"]').text('Email is required.');
			} else if ((required_fields.email.length > 0) && (!emailPattern.test(required_fields.email))){
				valid += '<p> Proper email format required. </p>';
				$('#editUserForm_email').next('div[class="validation"]').text('Proper email format required.');
			} else if ((jQuery.inArray(required_fields.email, existingEmails) >= 0) && (currentEmail != existingEmails[(jQuery.inArray(required_fields.email, existingEmails))])) {
				valid += '<p> This email has been taken. </p>';
				$('form[id="editUserForm"] #editUserForm_email').next('div[class="validation"]').text('This email has been taken.');
			} else {
				$('form[id="editUserForm"] #editUserForm_email').next('div[class="validation"]').text('');	
			}

			if(required_fields.password == ''){
				valid += '<p> Password is required. </p>';
				$('form[id="editUserForm"] #editUserForm_hashed_password').next('div[class="validation"]').text('Password is required.');
			} else {
				$('form[id="editUserForm"] #editUserForm_hashed_password').next('div[class="validation"]').text('');	
			}

			if(required_fields.passwordConfirmation == ''){
				valid += '<p> Password Confirmation is required. </p>';
				$('form[id="editUserForm"] #editUserForm_name').next('div[class="validation"]').text('');
			} else {
				$('form[id="editUserForm"] #editUserForm_name').next('div[class="validation"]').text('');	
			}

			if(required_fields.password != required_fields.passwordConfirmation){
				valid += '<p> Password and Password Confirmation don\'t match.</p>';
				$('form[id="editUserForm"] #editUserForm_passwordConfirmation').next('div[class="validation"]').text('Password and Password Confirmation don\'t match.');	
			} else {
				$('form[id="editUserForm"] #editUserForm_passwordConfirmation').next('div[class="validation"]').text('');	
			}	

			if(required_fields.club == ''){
				valid += '<p> A club is required. </p>';
				$('form[id="editUserForm"] #editUserForm_club').next('div[class="validation"]').text('A club is required.');
			} else {
				$('form[id="editUserForm"] #editUserForm_club').next('div[class="validation"]').text('');	
			}
			if(jQuery.inArray(required_fields.club, validClubs) == -1){
				valid += '<p> Invalid club selected. </p>';
				$('form[id="editUserForm"] #editUserForm_club').next('div[class="validation"]').text('Invalid club selected.');
			} else {
				passwordIndex = jQuery.inArray(required_fields.club, validClubs);
				required_fields.clubPasswordVerification = clubsAndPasswords[passwordIndex];
				$('form[id="editUserForm"] #editUserForm_club').next('div[class="validation"]').text('');	
			}

			if(required_fields.clubPassword == ''){
				valid += '<p> Please enter a club password. </p>';
				$('form[id="editUserForm"] #editUserForm_clubPassword').next('div[class="validation"]').text('Please enter a club password.');
			} else {
				$('form[id="editUserForm"] #editUserForm_clubPassword').next('div[class="validation"]').text('');	
			}

			if(required_fields.clubPassword != required_fields.clubPasswordVerification){
				valid += '<p> Invalid club password. </p>';
				$('form[id="editUserForm"] #editUserForm_clubPassword').next('div[class="validation"]').text('Invalid club password.');
			} else {
				$('form[id="editUserForm"] #editUserForm_clubPassword').next('div[class="validation"]').text('');	
			}

			if(required_fields.role == ''){
				valid += '<p> A role is required. </p>';
				$('form[id="editUserForm"] #editUserForm_role').next('div[class="validation"]').text('A role is required.');
			} else if((required_fields.role < 1) || (required_fields.role > 4)){
				valid += '<p> Please select a proper user role. </p>';
				$('form[id="editUserForm"] #editUserForm_role').next('div[class="validation"]').text('Please select a proper user role.');
			} else {
				$('form[id="editUserForm"] #editUserForm_role').next('div[class="validation"]').text('');	
			}	

			if(valid.length > 0){
				$('div[class="alert alert-error"]').remove();
				$('div[class="alert alert-success"]').remove();
				errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
				$("#registerErrorMessages").append(errorDisplay);
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
			} else {
				userFormData = $('form[id="userRegistrationForm"]').serialize();
				this.submitData('editUser.php',userFormData, formid,"#users","userALE.php");
			}
		}
	}

	validator.validateRoles = function(roleFields, existingRoles, currentRole){

		var valid = '';
		var required = ' is required.';
		var errorDisplay ;
		var registrationFormData;
		var editRoleFormData;
		var formid = '#userRoleInputForm';
		if(roleFields.role == ''){
			$('form[id="userRoleInputForm"] #uploadRole_role').siblings('div[class="validation"]').text('A role is required.');
			valid += '<p> A role is required. </p>';
		} else if ((jQuery.inArray(roleFields.role, existingRoles) >= 0) && (currentRole != existingRoles[(jQuery.inArray(roleFields.role, existingRoles))]) ) {

			$('form[id="userRoleInputForm"] #uploadRole_role').siblings('div[class="validation"]').text('This role already exists.');
			valid += '<p> This role already exists. </p>';
		} else {
			$('form[id="userRoleInputForm"] #uploadRole_role').siblings('div[class="validation"]').text('');	
		}	

		if(valid.length > 0){
			$('div[class="alert alert-error"]').remove();
			$('div[class="alert alert-success"]').remove();
			errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
			$('#registerErrorMessages').append(errorDisplay);
			$('#registerErrorMessages').removeAttr('style');
			$('#registerErrorMessages').fadeOut(2000);
		} else {
			if($('#userRoleInputForm').length){
				registrationFormData = $('form[id="userRoleInputForm"]').serialize();
				this.submitData('uploadRole.php',registrationFormData,formid,'#roles','userRoleALE.php');
			} else if($('#editRoleForm').length) {
				editRoleFormData = $('#editRoleForm').serialize();
				this.submitData('editRole.php',editRoleFormData,formid,'#roles','userRoleALE.php');
			}
		}

	} 

	validator.validateManuals = function(manualFields, existingManuals, currentManual){
		var valid = '';
		var required = ' is required.';
		var errorDisplay ;
		var registrationFormData;
		var editManualFormData;
		var formid = '#manualAddForm';
		if(manualFields.manual == ''){
			$('#manualAddForm #uploadManual_description').siblings('div[class="validation"]').text('A manual is required.');
			valid += '<p> A manual is required. </p>';
		} else if ((jQuery.inArray(manualFields.manual, existingManuals) >= 0) && (currentManual != existingManuals[(jQuery.inArray(manualFields.manual, existingManuals))]) ) {

			$('#manualAddForm #uploadManual_description').siblings('div[class="validation"]').text('This manual already exists.');
			valid += '<p> This manual already exists. </p>';
		} else {
			$('#manualAddForm #uploadManual_description').siblings('div[class="validation"]').text('');	
		}	

		if(valid.length > 0){
			$('div[class="alert alert-error"]').remove();
			$('div[class="alert alert-success"]').remove();
			errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
			$('#registerErrorMessages').append(errorDisplay);
			$('#registerErrorMessages').removeAttr('style');
			$('#registerErrorMessages').fadeOut(2000);
		} else {
			if($('#manualAddForm').length){
				registrationFormData = $('#manualAddForm').serialize();
				this.submitData('uploadManual.php',registrationFormData,formid,'#manuals','manualALE.php');
			} else if($('#editManualForm').length) {
				editManualFormData = $('#editManualForm').serialize();
				this.submitData('editManual.php',editManualFormData,formid,'#manuals','manualALE.php');
			}
		}

	} 
	validator.validateCategories = function(categoryFields, uploadCategory_existingTitles, currentTitle){
		var valid = '';
		var required = ' is required.';
		var errorDisplay ;
		var registrationFormData;
		var editCategoryFormData;
		var formid = '#categorySubmit';


		if($('#categorySubmit').length){

			if(categoryFields.categoryTitle == ''){
				valid += '<p> A title is required. </p>';
				$('#categorySubmit #uploadCategory_category_title').next('div[class="validation"]').text('A title is required.');
			} else if ((jQuery.inArray(categoryFields.categoryTitle, uploadCategory_existingTitles[categoryFields.currentSelectedManual]) >= 0))  {
				valid += '<p> This title already exists for this manual. </p>';
				$('#categorySubmit #uploadCategory_category_title').next('div[class="validation"]').text('This title already exists for this manual.');
			} else {
				$('#categorySubmit #uploadCategory_category_title').next('div[class="validation"]').text('');	
			}	

			if(categoryFields.categoryDescription == ''){
				valid += '<p> A description is required. </p>';
				$('#categorySubmit #uploadCategory_category_description').next().text('A description is required.');
			} else {
				$('#categorySubmit #uploadCategory_category_description').next('div[class="validation"]').text('');	
			}

		} else if($('#editCategoryForm').length) {

			formid = '#editCategoryForm';
			if(categoryFields.categoryTitle == ''){
				valid += '<p> A title is required. </p>';
				$('#editCategoryForm #editCategory_category_title').next('div[class="validation"]').text('A title is required.');
			} else if ((jQuery.inArray(categoryFields.categoryTitle, uploadCategory_existingTitles[categoryFields.currentSelectedManual]) >= 0) && (currentTitle != uploadCategory_existingTitles[categoryFields.currentSelectedManual][(jQuery.inArray(categoryFields.categoryTitle, uploadCategory_existingTitles[categoryFields.currentSelectedManual]))])) {
				valid += '<p> This title already exists for this manual. </p>';
				$('#editCategoryForm #editCategory_category_title').next('div[class="validation"]').text('This title already exists for this manual.');
			} else {
				$('#editCategoryForm #editCategory_category_title').next('div[class="validation"]').text('');	
			}	

			if(categoryFields.categoryDescription == ''){
				valid += '<p> A description is required. </p>';
				$('#editCategoryForm #editCategory_category_description').next().text('A description is required.');
			} else {
				$('#editCategoryForm #editCategory_category_description').next('div[class="validation"]').text('');	
			}
		}

		if(valid.length > 0){
			$('div[class="alert alert-error"]').remove();
			$('div[class="alert alert-success"]').remove();
			errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
			$('#registerErrorMessages').append(errorDisplay);
			$('#registerErrorMessages').removeAttr('style');
			$('#registerErrorMessages').fadeOut(2000);
		} else {
			if($('#categorySubmit').length){
				registrationFormData = $('#categorySubmit').serialize();
				this.submitData('uploadCategory.php',registrationFormData,formid,'#speechCategories','categoryALE.php');
			} else if($('#editCategoryForm').length) {
				editCategoryFormData = $('#editCategoryForm').serialize();
				this.submitData('editCategory.php',editCategoryFormData,formid,'#speechCategories','categoryALE.php');
			}
		}

	} 
	validator.validateClubs = function(clubFields, uploadClubs_existingClubs, currentClub){
		var valid = '';
		var required = ' is required.';
		var errorDisplay ;
		var registrationFormData;
		var editClubFormData;
		var formid = '#uploadClubsForm';

		if($('#uploadClubsForm').length){

			if(clubFields.name == ''){
				valid += '<p> A club name is required. </p>';
				$('#uploadClubsForm #uploadClubsForm_name').next('div[class="validation"]').text('A club name is required.');
			} else if (jQuery.inArray(clubFields.name, uploadClubs_existingClubs) >= 0) {
				valid += '<p> This club name has been taken. </p>';
				$('#uploadClubsForm #uploadClubsForm_name').next('div[class="validation"]').text('This club name has been taken.');
			} else {
				$('#uploadClubsForm #uploadClubsForm_name').next('div[class="validation"]').text('');	
			}

			if(clubFields.address == ''){
				valid += '<p> An address is required. </p>';
				$('#uploadClubsForm #uploadClubsForm_address').next('div[class="validation"]').text('An address is required.');	
			} else {
				$('#uploadClubsForm #uploadClubsForm_address').next('div[class="validation"]').text('');	
			}

			if(clubFields.state == ''){
				valid += '<p> A state is required. </p>';
				$('#uploadClubsForm #uploadClubsForm_state').next('div[class="validation"]').text('A state is required.');	
			} else {
				$('#uploadClubsForm #uploadClubsForm_state').next('div[class="validation"]').text('');	
			}

			if(clubFields.city == ''){
				valid += '<p> A city is required. </p>';
				$('#uploadClubsForm #uploadClubsForm_city').next('div[class="validation"]').text('A city is required.');	
			} else {
				$('#uploadClubsForm #uploadClubsForm_city').next('div[class="validation"]').text('');	
			}

			if(clubFields.zip == ''){
				valid += '<p> Zip is required. </p>';
				$('#uploadClubsForm #uploadClubsForm_zip').next('div[class="validation"]').text('A zip is required.');	
			} else {
				$('#uploadClubsForm #uploadClubsForm_zip').next('div[class="validation"]').text('');	
			}

			if(clubFields.password == ''){
				valid += '<p> Password is required. </p>';
				$('#uploadClubsForm #uploadClubsForm_password').next('div[class="validation"]').text('A password is required.');	
			} else {
				$('#uploadClubsForm #uploadClubsForm_password').next('div[class="validation"]').text('');	
			}

		} else if($('#editClubForm').length) {

			formid = '#editClubForm';

			if(clubFields.name == ''){
				valid += '<p> A club name is required. </p>';
				$('#editClubForm #editClub_name').next('div[class="validation"]').text('A club name is required.');
			} else if ((jQuery.inArray(clubFields.name, uploadClubs_existingClubs) >= 0) && (currentClub != uploadClubs_existingClubs[(jQuery.inArray(clubFields.name, uploadClubs_existingClubs))])) {
				valid += '<p> This club name has been taken. </p>';
				$('#editClubForm #editClub_name').next('div[class="validation"]').text('This club name has been taken.');
			} else {
				$('#editClubForm #editClub_name').next('div[class="validation"]').text('');	
			}

			if(clubFields.address == ''){
				valid += '<p> An address is required. </p>';
				$('#editClubForm #editClub_address').next('div[class="validation"]').text('An address is required.');	
			} else {
				$('#editClubForm #editClub_address').next('div[class="validation"]').text('');	
			}

			if(clubFields.state == ''){
				valid += '<p> A state is required. </p>';
				$('#editClubForm #editClub_state').next('div[class="validation"]').text('A state is required.');	
			} else {
				$('#editClubForm #editClub_state').next('div[class="validation"]').text('');	
			}

			if(clubFields.city == ''){
				valid += '<p> A city is required. </p>';
				$('#editClubForm #editClub_city').next('div[class="validation"]').text('A city is required.');	
			} else {
				$('#editClubForm #editClub_city').next('div[class="validation"]').text('');	
			}

			if(clubFields.zip == ''){
				valid += '<p> Zip is required. </p>';
				$('#editClubForm #editClub_zip').next('div[class="validation"]').text('A zip is required.');	
			} else {
				$('#editClubForm #editClub_zip').next('div[class="validation"]').text('');	
			}

			if(clubFields.password == ''){
				valid += '<p> Password is required. </p>';
				$('#editClubForm #editClub_password').next('div[class="validation"]').text('A password is required.');	
			} else {
				$('#editClubForm #editClub_password').next('div[class="validation"]').text('');	
			}
		}

		if(valid.length > 0){
			$('div[class="alert alert-error"]').remove();
			$('div[class="alert alert-success"]').remove();
			errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
			$('#registerErrorMessages').append(errorDisplay);
			$('#registerErrorMessages').removeAttr('style');
			$('#registerErrorMessages').fadeOut(2000);
		} else {
			if($('#uploadClubsForm').length){
				registrationFormData = $('#uploadClubsForm').serialize();
				this.submitData('uploadClubs.php',registrationFormData,formid,'#clubs','clubALE.php');
			} else if($('#editClubForm').length) {
				editClubFormData = $('#editClubForm').serialize();
				this.submitData('editClub.php',editClubFormData,formid,'#clubs','clubALE.php');
			}
		}

	} 

	validator.submitData = function(destinationUrl, formData, formid, containerToReset, viewToReset){
		
		$.ajax({
			type:'POST',
			url: destinationUrl,
			data:formData,
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				$('div[class="alert alert-error"]').remove();
				$('div[class="alert alert-success"]').remove();
				$('#registerErrorMessages').append('<div class="alert alert-success">User registered!</div>');
				$('#registerErrorMessages').removeAttr('style');
				$('#registerErrorMessages').fadeOut(2000);
				$(containerToReset).load(viewToReset);

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">The user could not be registered.</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
			},
			complete: function(XMLHttpRequest, status){
				$(formid)[0].reset();
			}
		});
	}
	return validator;
}());
