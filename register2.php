<?php
	require_once("user.php");
	require_once("userrole.php");
	require_once("Club.php");
	require_once("function.php");
	require_once("Session.php");


	if($SESS->userRoleId != ADMIN_USER){
		$SESS->logout();
		redirect_to("login.php", 1, "Access Denied.");
	}

	$users = User::find_all();
	$userRoles = UserRole::find_all();
	$clubs = Club::find_all();

	$errors = array();
	$required_fields = array('uploadUserForm_username','uploadUserForm_first_name','uploadUserForm_last_name','uploadUserForm_hashed_password', 'uploadUserForm_email', 'uploadUserForm_role', 'uploadUserForm_club');


    

	if(isset($_POST['submit'])){

		foreach($required_fields as $required_field){
			if(!(isset($_POST[$required_field])) || (empty($_POST[$required_field]) && is_numeric($_POST[$required_field]))){
				$error[] = $required_field . ' is a required field';
			}
		}

		if(empty($errors)){

			$un = mysql_real_escape_string(htmlspecialchars($_POST['uploadUserForm_username']));
			$pw = mysql_real_escape_string(htmlspecialchars($_POST['uploadUserForm_hashed_password']));
			$fn = mysql_real_escape_string(htmlspecialchars($_POST['uploadUserForm_first_name']));
			$ln = mysql_real_escape_string(htmlspecialchars($_POST['uploadUserForm_last_name']));
			$e = mysql_real_escape_string(htmlspecialchars($_POST['uploadUserForm_email']));
			$r = mysql_real_escape_string(htmlspecialchars($_POST['uploadUserForm_role']));
			$c = mysql_real_escape_string(htmlspecialchars($_POST['uploadUserForm_club']));


			$newUser = User::register($un, $pw, $fn, $ln, $e, $r, $c);
			if($newUser->save()){
				//redirect_to("redirect2.php");
			} else {
				die("Cannot register user. " . mysql_error());
			}
		}
		else {
			foreach($errors as $error){
				echo $error . '</br></br>' ;
			}
		}
	}
?>

	<script>
		// javascript variables
		var validClubs = Array();
		var clubAndPassword = Array();

		// Load existing values for examination 

		var uploadUsers_existingUserEmails = Array();
		var uploadUsers_existingUserUserNames = Array();
		<?php 
			foreach($users as $user){
		?>
			uploadUsers_existingUserEmails.push('<?=$user->email?>');
			uploadUsers_existingUserUserNames.push('<?=$user->username?>');
		<?php
			}
		?>
	</script>


		
		<div id="registration">
			<form action="register2.php" method="post" id="uploadUserForm">
				<fieldset>
					<legend>User Registration</legend>
					<div class="row-fluid">
						<div class="span6">
							<input  type="hidden" id="submit2" name="submit"/>
							<label for="uploadUserForm_first_name">First Name:</label>
							<input class="text" type="text" id="uploadUserForm_first_name" name="uploadUserForm_first_name"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
						<div class="span6">
							<label for="uploadUserForm_last_name">Last Name:</label>
							<input class="text" type="text" id="uploadUserForm_last_name" name="uploadUserForm_last_name"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
					</div>
					<div class="row-fluid">
						<div class="span6">
							<label for="uploadUserForm_username">User Name:</label>
							<input class="text" type="text" id="uploadUserForm_username" name="uploadUserForm_username"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
						<div class="span6">
							<label for="uploadUserForm_email">Email:</label>
							<input class="text" type="uploadUserForm_email" id="uploadUserForm_email" name="uploadUserForm_email"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
					</div>
					<div class="row-fluid">
						<div class="span6">
							<label for="uploadUserForm_hashed_password">Password:</label>
							<input class="text" type="password" id="uploadUserForm_hashed_password" name="uploadUserForm_hashed_password"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
						<div class="span6">
							<label for="uploadUserForm_passwordConfirmation">Password Confirmation:</label>
							<input class="text" type="password" name="uploadUserForm_passwordConfirmation" id="uploadUserForm_passwordConfirmation"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
					</div>
					<div class="row-fluid">
						<div class="span6">
							<label for="uploadUserForm_club">Club:</label>
							<select id="uploadUserForm_club" name="uploadUserForm_club">
							<?php 
								foreach($clubs as $club) {
							?>
								<script>
									validClubs.push('<?=$club->id?>');
									clubAndPassword.push('<?=$club->password?>');
								</script>
								<option value="<?=$club->id?>"><?=$club->name?></option>
							<?php
								}
							?>
							</select>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
						<div class="span6">
							<label for="uploadUserForm_clubPassword">Club Password:</label>
							<input class="text" type="password" name="uploadUserForm_clubPassword" id="uploadUserForm_clubPassword"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
					</div>
					<div class="row-fluid">
						<div class="span6">
							<label for="uploadUserForm_role">User Role:</label>
							<select id="uploadUserForm_role" name="uploadUserForm_role">
							<?php 
								foreach($userRoles as $userRole) {
							?>
								<option value="<?=$userRole->id?>"><?=$userRole->role?></option>
							<?php
								}
							?>
							</select>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
						<div class="span6">
						</div>
					</div>
					<input id="registerSubmit" type="submit" name="submit" class="btn btn-primary pull-right"/>
				</fieldset>
			</form>	
		</div>	
	<script>

	$('#uploadUserForm select').change(function(){
		var id = $(this).attr('id');
		var currentSelectedValue = $(this).val();
		// console.log(currentSelectedValue);

		switch(id){
			case 'uploadUserForm_role' :
				if((currentSelectedValue < 1) || (currentSelectedValue > 4)){
					$('form[id="uploadUserForm"] #uploadUserForm_role').next('div[class="validation"]').text('Please select a proper user role.');
				} else {
					$('form[id="uploadUserForm"] #uploadUserForm_role').next('div[class="validation"]').text('');	
				}		
				break;
			case 'uploadUserForm_club' :
				if((currentSelectedValue < 3) || (currentSelectedValue > 3)){
					$('form[id="uploadUserForm"] #uploadUserForm_club').next('div[class="validation"]').text('Invalid club selected.');
				} else {
					$('form[id="uploadUserForm"] #uploadUserForm_club').next('div[class="validation"]').text('');	
				}		
				break;
		}

		// $('#uploadTopic_topic_title').val('');
		// $('#uploadTopic_topic_title').next().text('');
		// $('#uploadTopic_description').val('');
		// $('#uploadTopic_description').next().text('');
		// $('#uploadTopic_topic_date').val('');
		// $('#uploadTopic_topic_date').next().text('');
	});

	$('#uploadUserForm input').blur(function(e){
		e.preventDefault();
		e.stopPropagation();
		var id = $(this).attr('id');
		var value = $(this).val();
		var emailPattern = /[a-zA-Z0-9]*@[a-zA-Z0-9]*\.[com]/;
		console.log(id);
		console.log(value);
		switch(id){
			case 'uploadUserForm_username' :
				if(value.length == 0){
					$('#uploadUserForm_username').next('div[class="validation"]').text('Username is required.');
				} else if (jQuery.inArray(value, uploadUsers_existingUserUserNames) >= 0) {
					$('#uploadUserForm_username').next('div[class="validation"]').text('This user name has been taken.');
				} else {
					$('#uploadUserForm_username').next('div[class="validation"]').text('');	
				}
				break;
			case 'uploadUserForm_first_name' :
				if(value.length == 0){
					$('#uploadUserForm_first_name').next('div[class="validation"]').text('A First Name is required.');
				} else {
					$('#uploadUserForm_first_name').next('div[class="validation"]').text('');	
				}
				break;
			case 'uploadUserForm_last_name' :
				if(value.length == 0){
					$('#uploadUserForm_last_name').next('div[class="validation"]').text('A Last Name is required.');
				} else {
					$('#uploadUserForm_last_name').next('div[class="validation"]').text('');	
				}
				break;
			case 'uploadUserForm_email' :
				if(value.length == 0){
					$('#uploadUserForm_email').next('div[class="validation"]').text('Email is required.');
				} else if ((value.length > 0) && (!emailPattern.test(value))){
					$('#uploadUserForm_email').next('div[class="validation"]').text('Proper email format required.');
				} else if (jQuery.inArray(value, uploadUsers_existingUserEmails) >= 0) {
					$('#uploadUserForm_email').next('div[class="validation"]').text('This email has been taken.');
				} else {
					$('#uploadUserForm_email').next('div[class="validation"]').text('');	
				}
				break;
			case 'uploadUserForm_hashed_password' :
				if(value.length == 0){
					$('#uploadUserForm_hashed_password').next('div[class="validation"]').text('Password is required.');
				} else {
					$('#uploadUserForm_hashed_password').next('div[class="validation"]').text('');	
				}
				break;
			case 'uploadUserForm_passwordConfirmation' :
				if(value.length == 0){
					$('#uploadUserForm_passwordConfirmation').next('div[class="validation"]').text('Password Confirmation is required.');
				} else {
					$('#uploadUserForm_passwordConfirmation').next('div[class="validation"]').text('');	
				}
				break;
			case 'uploadUserForm_clubPassword' :
				if(value.length == 0){
					$('#uploadUserForm_clubPassword').next('div[class="validation"]').text('A club password is required.');
				} else {
					$('#uploadUserForm_clubPassword').next('div[class="validation"]').text('');	
				}
				break;
			default: 
				break;
		}
	});

		$('#registerSubmit').click(function(e){
			e.preventDefault();
			e.stopPropagation();

			// alert('5');

			var valid = '';
			var errorDisplay = '' ;
			var required = ' is required.';
			var username = $('form[id="uploadUserForm"] #uploadUserForm_username').val();
			var firstname = $('form[id="uploadUserForm"] #uploadUserForm_first_name').val();
			var lastname = $('form[id="uploadUserForm"] #uploadUserForm_last_name').val();
			var email = $('form[id="uploadUserForm"] #uploadUserForm_email').val();
			var emailPattern = /[a-zA-Z0-9]*@[a-zA-Z0-9]*\.[com]/;
			var password = $('form[id="uploadUserForm"] #uploadUserForm_hashed_password').val();
			var passwordConfirmation = $('form[id="uploadUserForm"] #uploadUserForm_passwordConfirmation').val();
			var club = $('form[id="uploadUserForm"] #uploadUserForm_club').val();
			var clubPassword = $('form[id="uploadUserForm"] #uploadUserForm_clubPassword').val();
			var role = $('form[id="uploadUserForm"] #uploadUserForm_role').val();


			if(username == ''){
				valid += '<p> Username is required. </p>';
				$('form[id="uploadUserForm"] #uploadUserForm_username').next('div[class="validation"]').text('Username is required.');
			} else if (jQuery.inArray(username, uploadUsers_existingUserUserNames) >= 0) {
				valid += '<p> This user name has been taken. </p>';
					$('#uploadUserForm_username').next('div[class="validation"]').text('This user name has been taken.');
			} else {
				$('form[id="uploadUserForm"] #uploadUserForm_username').next('div[class="validation"]').text('');	
			}

			if(firstname == ''){
				valid += '<p> A First Name is required. </p>';
				$('form[id="uploadUserForm"] #uploadUserForm_first_name').next('div[class="validation"]').text('A First Name is required.');
			} else {
				$('form[id="uploadUserForm"] #uploadUserForm_first_name').next('div[class="validation"]').text('');	
			}

			if(lastname == ''){
				valid += '<p> A Last Name is required. </p>';
				$('form[id="uploadUserForm"] #uploadUserForm_last_name').next('div[class="validation"]').text('A Last Name is required.');
			} else {
				$('form[id="uploadUserForm"] #uploadUserForm_last_name').next('div[class="validation"]').text('');	
			}

			if(email == ''){
				valid += '<p> Email is required. </p>';
				$('form[id="uploadUserForm"] #uploadUserForm_email').next('div[class="validation"]').text('Email is required.');
			} else if ((email.length > 0) && (!emailPattern.test(email))){
				valid += '<p> Proper email format required. </p>';
				$('#uploadUserForm_email').next('div[class="validation"]').text('Proper email format required.');
			} else if (jQuery.inArray(email, uploadUsers_existingUserEmails) >= 0) {
				valid += '<p> This email has been taken. </p>';
				$('form[id="uploadUserForm"] #uploadUserForm_email').next('div[class="validation"]').text('This email has been taken.');
			} else {
				$('form[id="uploadUserForm"] #uploadUserForm_email').next('div[class="validation"]').text('');	
			}

			if(password == ''){
				valid += '<p> Password is required. </p>';
				$('form[id="uploadUserForm"] #uploadUserForm_hashed_password').next('div[class="validation"]').text('Password is required.');
			} else {
				$('form[id="uploadUserForm"] #uploadUserForm_hashed_password').next('div[class="validation"]').text('');	
			}

			if(passwordConfirmation == ''){
				valid += '<p> Password Confirmation is required. </p>';
				$('form[id="uploadUserForm"] #uploadUserForm_name').next('div[class="validation"]').text('');
			} else {
				$('form[id="uploadUserForm"] #uploadUserForm_name').next('div[class="validation"]').text('');	
			}

			if(password != passwordConfirmation){
				valid += '<p> Password and Password Confirmation don\'t match.</p>';
				$('form[id="uploadUserForm"] #uploadUserForm_passwordConfirmation').next('div[class="validation"]').text('Password and Password Confirmation don\'t match.');	
			} else {
				$('form[id="uploadUserForm"] #uploadUserForm_passwordConfirmation').next('div[class="validation"]').text('');	
			}	

			if(club == ''){
				valid += '<p> A club is required. </p>';
				$('form[id="uploadUserForm"] #uploadUserForm_club').next('div[class="validation"]').text('A club is required.');
			} else {
				$('form[id="uploadUserForm"] #uploadUserForm_club').next('div[class="validation"]').text('');	
			}

			if(jQuery.inArray(club, validClubs) == -1){
				valid += '<p> Invalid club selected. </p>';
				$('form[id="uploadUserForm"] #uploadUserForm_club').next('div[class="validation"]').text('Invalid club selected.');
			} else {
				passwordIndex = jQuery.inArray(club, validClubs);
				clubPasswordVerification = clubAndPassword[passwordIndex];
				$('form[id="uploadUserForm"] #uploadUserForm_club').next('div[class="validation"]').text('');	
			}

			if(clubPassword == ''){
				valid += '<p> Please enter a club password. </p>';
				$('form[id="uploadUserForm"] #uploadUserForm_clubPassword').next('div[class="validation"]').text('Please enter a club password.');
			} else {
				$('form[id="uploadUserForm"] #uploadUserForm_clubPassword').next('div[class="validation"]').text('');	
			}

			if(clubPassword != clubPasswordVerification){
				valid += '<p> Invalid club password. </p>';
				$('form[id="uploadUserForm"] #uploadUserForm_clubPassword').next('div[class="validation"]').text('Invalid club password.');
			} else {
				$('form[id="uploadUserForm"] #uploadUserForm_clubPassword').next('div[class="validation"]').text('');	
			}

			if(role == ''){
				valid += '<p> A role is required. </p>';
				$('form[id="uploadUserForm"] #uploadUserForm_role').next('div[class="validation"]').text('A role is required.');
			} else if((role < 1) || (role > 4)){
				valid += '<p> Please select a proper user role. </p>';
				$('form[id="uploadUserForm"] #uploadUserForm_role').next('div[class="validation"]').text('Please select a proper user role.');
			} else {
				$('form[id="uploadUserForm"] #uploadUserForm_role').next('div[class="validation"]').text('');	
			}	

			if(valid.length > 0){
				$('div[class="alert alert-error"]').remove();
				$('div[class="alert alert-success"]').remove();
				errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
				$("#registerErrorMessages").append(errorDisplay);
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
			} else {
				userFormData = $('form[id="uploadUserForm"]').serialize();
				submitUserData(userFormData);
			}
		});

		function submitUserData(formData){
			$.ajax({
				type:'POST',
				url: 'register2.php',
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
					$('#userListingBlock').load('userALE.php');

				},
				error: function(XMLHttpRequest, textStatus, errorThrown){
					$('#registerErrorMessages div[class="alert alert-error"]').remove();
					$("#registerErrorMessages").append('<div class="alert alert-error">The user could not be registered.</div>');
					$("#registerErrorMessages").removeAttr('style');
					$("#registerErrorMessages").fadeOut(2000);
				},
				complete: function(XMLHttpRequest, status){
					$('form[id="uploadUserForm"]')[0].reset();
				}
			});
		};
</script>