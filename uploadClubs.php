<?php
require_once("constants.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("Club.php");
require_once("function.php");

if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}

if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
}

$clubs = Club::find_all();

if(isset($_POST['submit'])){
	$name = mysql_real_escape_string(htmlspecialchars($_POST['uploadClubsForm_name']));
	$address = mysql_real_escape_string(htmlspecialchars($_POST['uploadClubsForm_address']));
	$city = mysql_real_escape_string(htmlspecialchars($_POST['uploadClubsForm_city']));
	$state = mysql_real_escape_string(htmlspecialchars($_POST['uploadClubsForm_state']));
	$zip = mysql_real_escape_string(htmlspecialchars($_POST['uploadClubsForm_zip']));
	$password = mysql_real_escape_string(htmlspecialchars($_POST['uploadClubsForm_password']));

	$newClub = Club::newClub($name, $address, $city, $state, $zip, $password);

	if($newClub->save()){
		redirect_to("settings.php");
	} else {
		die("Cannot create club." . mysql_error());
	}	
}

?>

<!-- Load existing values for examination -->
<script>
	var uploadClubs_existingClubs = Array();
<?php 
	foreach($clubs as $club){
?>
	uploadClubs_existingClubs.push('<?=$club->name?>');
<?php
	}
?>
</script>
	<!-- <div id="registerErrorMessages"></div> -->
		<form id="uploadClubsForm" action="uploadClubs.php" method="post">
			<fieldset>
				<legend>New Club:</legend>
					<div class="row-fluid">
						<div class="span6">
							<label for="uploadClubsForm_name">Name:</label>
							<input class="text" type="text" id="uploadClubsForm_name" name="uploadClubsForm_name"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
						<div class="span6">
							<label for="uploadClubsForm_address">Address:</label>
							<input class="text" type="text" id="uploadClubsForm_address" name="uploadClubsForm_address"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
					</div>
					<div class="row-fluid">
						<div class="span6">
							<label for="uploadClubsForm_city">City:</label>
							<input class="text" type="text" id="uploadClubsForm_city" name="uploadClubsForm_city"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
						<div class="span6">
							<label for="uploadClubsForm_state">State:</label>
							<input class="text" type="text" id="uploadClubsForm_state" name="uploadClubsForm_state"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
					</div>
					<div class="row-fluid">
						<div class="span6">
							<label for="uploadClubsForm_zip">Zip:</label>
							<input class="text" type="text" id="uploadClubsForm_zip" name="uploadClubsForm_zip"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
						<div class="span6">
							<label for="uploadClubsForm_password">Password:</label>
							<input class="text" type="uploadClubsForm_password" name="uploadClubsForm_password" id="uploadClubsForm_password"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
					</div>
				<input type="hidden" id="submit2" name="submit"/>
				<input id="clubSubmit" type="submit" name="submit" value="submit"/>
			</fieldset>
		</form>

<script>	

	$('#uploadClubsForm input').blur(function(e){
		e.preventDefault();
		e.stopPropagation();
		var id = $(this).attr('id');
		var value = $(this).val();
		console.log(id);
		console.log(value);
		switch(id){
			case 'uploadClubsForm_name' :
				if(value.length == 0){
					$('#uploadClubsForm_name').next('div[class="validation"]').text('A club name is required.');
				} else if (jQuery.inArray(value, uploadClubs_existingClubs) >= 0) {
					$('#uploadClubsForm_name').next('div[class="validation"]').text('This club name has been taken.');
				} else {
					$('#uploadClubsForm_name').next('div[class="validation"]').text('');	
				}
				break;
			case 'uploadClubsForm_address' :
				if(value.length == 0){
					$('#uploadClubsForm_address').next('div[class="validation"]').text('An address is required.');
				} else {
					$('#uploadClubsForm_address').next('div[class="validation"]').text('');	
				}
				break;
			case 'uploadClubsForm_city' :
				if(value.length == 0){
					$('#uploadClubsForm_city').next('div[class="validation"]').text('A city is required.');
				} else {
					$('#uploadClubsForm_city').next('div[class="validation"]').text('');	
				}
				break;
			case 'uploadClubsForm_state' :
				if(value.length == 0){
					$('#uploadClubsForm_state').next('div[class="validation"]').text('A state is required.');
				} else {
					$('#uploadClubsForm_state').next('div[class="validation"]').text('');	
				}
				break;
			case 'uploadClubsForm_zip' :
				if(value.length == 0){
					$('#uploadClubsForm_zip').next('div[class="validation"]').text('A zip is required.');
				} else {
					$('#uploadClubsForm_zip').next('div[class="validation"]').text('');	
				}
				break;
			case 'uploadClubsForm_password' :
				if(value.length == 0){
					$('#uploadClubsForm_password').next('div[class="validation"]').text('A password is required.');
				} else {
					$('#uploadClubsForm_password').next('div[class="validation"]').text('');	
				}
				break;
			default: 
				break;
		}
	});

	$('#addEditClubsBlock').unbind();
	$('#addEditClubsBlock').on('click','#clubSubmit', function(e){
		e.preventDefault();
		e.stopPropagation();

		// alert('19');

		var valid = '';
		var errorDisplay = '' ;
		var required = ' is required.';
		var name = $('form[id="uploadClubsForm"] #uploadClubsForm_name').val();
		var address = $('form[id="uploadClubsForm"] #uploadClubsForm_address').val();
		var city = $('form[id="uploadClubsForm"] #uploadClubsForm_city').val();
		var state = $('form[id="uploadClubsForm"] #uploadClubsForm_state').val();
		var zip = $('form[id="uploadClubsForm"] #uploadClubsForm_zip').val();
		var password = $('form[id="uploadClubsForm"] #uploadClubsForm_password').val();

		console.log(name);
		console.log(address);
		console.log(city);
		console.log(state);
		console.log(zip);
		console.log(password);


		if(name == ''){
			valid += '<p> A club name is required. </p>';
			$('form[id="uploadClubsForm"] #uploadClubsForm_name').next('div[class="validation"]').text('A club name is required.');
		} else if (jQuery.inArray(name, uploadClubs_existingClubs) >= 0) {
			valid += '<p> This club name has been taken. </p>';
			$('form[id="uploadClubsForm"] #uploadClubsForm_name').next('div[class="validation"]').text('This club name has been taken.');
		} else {
			$('form[id="uploadClubsForm"] #uploadClubsForm_name').next('div[class="validation"]').text('');	
		}

		if(address == ''){
			valid += '<p> An address is required. </p>';
			$('form[id="uploadClubsForm"] #uploadClubsForm_address').next('div[class="validation"]').text('An address is required.');	
		} else {
			$('form[id="uploadClubsForm"] #uploadClubsForm_address').next('div[class="validation"]').text('');	
		}

		if(state == ''){
			valid += '<p> A state is required. </p>';
			$('form[id="uploadClubsForm"] #uploadClubsForm_state').next('div[class="validation"]').text('A state is required.');	
		} else {
			$('form[id="uploadClubsForm"] #uploadClubsForm_state').next('div[class="validation"]').text('');	
		}

		if(city == ''){
			valid += '<p> A city is required. </p>';
			$('form[id="uploadClubsForm"] #uploadClubsForm_city').next('div[class="validation"]').text('A city is required.');	
		} else {
			$('form[id="uploadClubsForm"] #uploadClubsForm_city').next('div[class="validation"]').text('');	
		}

		if(zip == ''){
			valid += '<p> Zip is required. </p>';
			$('form[id="uploadClubsForm"] #uploadClubsForm_zip').next('div[class="validation"]').text('A zip is required.');	
		} else {
			$('form[id="uploadClubsForm"] #uploadClubsForm_zip').next('div[class="validation"]').text('');	
		}

		if(password == ''){
			valid += '<p> Password is required. </p>';
			$('form[id="uploadClubsForm"] #uploadClubsForm_password').next('div[class="validation"]').text('A password is required.');	
		} else {
			$('form[id="uploadClubsForm"] #uploadClubsForm_password').next('div[class="validation"]').text('');	
		}
		if(valid.length > 0){
			$('div[class="alert alert-error"]').remove();
			$('div[class="alert alert-success"]').remove();
			errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
			$("#registerErrorMessages").append(errorDisplay);
			$("#registerErrorMessages").removeAttr('style');
			$("#registerErrorMessages").fadeOut(2000);
		} else {
			clubFormData = $('form[id="uploadClubsForm"]').serialize();
			submitClubData(clubFormData);
		}
	});



	function submitClubData(formData){
		$.ajax({
			type:'POST',
			url: 'uploadClubs.php',
			data:formData,
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				$('div[class="alert alert-error"]').remove();
				$('div[class="alert alert-success"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-success">Club added!</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
				$("#clubsListingBlock").load("clubListing.php");

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">The club could not be added.</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="uploadClubsForm"]')[0].reset();
			}
		});
	};

</script>