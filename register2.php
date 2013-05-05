<?php


	require_once("user.php");
	require_once("userrole.php");
	require_once("function.php");
	require_once("Session.php");


	if($SESS->userRoleId != ADMIN_USER){
		$SESS->logout();
		redirect_to("login.php", 1, "Access Denied.");
	}

	$userRoles = UserRole::find_all();
	$errors = array();
	$required_fields = array('username','first_name','last_name','hashed_password', 'email', 'role');


    

	if(isset($_POST['submit'])){

		foreach($required_fields as $required_field){
			if(!(isset($_POST[$required_field])) || (empty($_POST[$required_field]) && is_numeric($_POST[$required_field]))){
				$error[] = $required_field . ' is a required field';
			}
		}

		if(empty($errors)){

			$un = mysql_real_escape_string(htmlspecialchars($_POST['username']));
			$pw = mysql_real_escape_string(htmlspecialchars($_POST['hashed_password']));
			$fn = mysql_real_escape_string(htmlspecialchars($_POST['first_name']));
			$ln = mysql_real_escape_string(htmlspecialchars($_POST['last_name']));
			$e = mysql_real_escape_string(htmlspecialchars($_POST['email']));
			$r = mysql_real_escape_string(htmlspecialchars($_POST['role']));


			$newUser = User::register($un, $pw, $fn, $ln, $e, $r);
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
		
		
		<div id="registration">
		<form action="register.php" method="post" id="userRegistrationForm">
			<fieldset>
				<legend>User Registration</legend>
				<p>
					<input  type="hidden" id="submit2" name="submit"/>
					<label for="first_name">First Name:</label>
					<input class="text" type="text" id="first_name" name="first_name"/>
				</p>
				<p>
					<label for="last_name">Last Name:</label>
					<input class="text" type="text" id="last_name" name="last_name"/>
				</p>
				<p>
					<label for="username">User Name:</label>
					<input class="text" type="text" id="username" name="username"/>
				</p>
				<p>
					<label for="email">Email:</label>
					<input class="text" type="email" id="email" name="email"/>
				</p>
				<p>
					<label for="password">Password:</label>
					<input class="text" type="password" id="hashed_password" name="hashed_password"/>
				</p>
				<p>
					<label for="passwordConfirmation">Password Confirmation:</label>
					<input class="text" type="password" name="passwordConfirmation" id="passwordConfirmation"/>
				</p>
				<p>
					<label for="role">User Role:</label>
					<select id="role" name="role">
					<?php 
						foreach($userRoles as $userRole) {
					?>
						<option value="<?=$userRole->id?>"><?=$userRole->role?></option>
					<?php
						}
					?>
					</select>
				</p>
				<p>
					<input id="registerSubmit" type="submit" name="submit" class="btn btn-primary"/>
				</p>
			</fieldset>
		</form>	
		</div>	
	<script>
	$("#settingsControls").unbind();
	$('#settingsControls').on("click","#registerSubmit", function(e){
		e.preventDefault();
		e.stopPropagation();

		//alert('5');

		var valid = '';
		var errorDisplay = '' ;
		var required = ' is required.';
		var username = $('form[id="userRegistrationForm"] #username').val();
		var firstname = $('form[id="userRegistrationForm"] #first_name').val();
		var lastname = $('form[id="userRegistrationForm"] #last_name').val();
		var password = $('form[id="userRegistrationForm"] #hashed_password').val();
		var passwordConfirmation = $('form[id="userRegistrationForm"] #passwordConfirmation').val();
		var role = $('form[id="userRegistrationForm"] #role').val();

		if(username == ''){
			valid += '<p> Username is required. </p>';
		}

		if(firstname == ''){
			valid += '<p> A First Name is required. </p>';
		}

		if(lastname == ''){
			valid += '<p> A Last Name is required. </p>';
		}

		if(password == ''){
			valid += '<p> Password is required. </p>';
		}

		if(passwordConfirmation == ''){
			valid += '<p> Password Confirmation is required. </p>';
		}	

		if(role == ''){
			valid += '<p> A role is required. </p>';
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
				$("#registerErrorMessages").append('<div class="alert alert-success">User registered!</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
				$("#settingsControls").load("userALE.php");

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">The user could not be registered.</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="userRegistrationForm"]')[0].reset();
			}
		});
	};
</script>